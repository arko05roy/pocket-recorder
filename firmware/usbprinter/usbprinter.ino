// USB print server (from esp32s3-print-server-guide.html, ported to Arduino).
// The S3's USB OTG port runs as a USB *host* on GPIO19 (D-) / GPIO20 (D+),
// wired to a USB-A female breakout that the printer's cable plugs into.
// Two ways in, one printer out:
//   - port 9100 raw socket: the Mac adds it as "HP Jetdirect - Socket" and prints with its driver
//   - POST /print (HTTP 80): the Vyohm app sends plain text after you press Print
// Power and flash through the board's UART USB-C port; the native USB port is now the printer's.
// LED: blue = Wi-Fi, yellow = no printer, green = ready, white = printing, red = error.

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "usb/usb_host.h"
#include "secrets.h"

#define RAW_PORT 9100
#define CHUNK 4096           // multiple of 64, the full-speed packet size
#define USB_TIMEOUT_MS 60000 // printers can stall while warming up

const uint8_t B = 32;
void led(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(RGB_BUILTIN, r, g, b); }

static usb_host_client_handle_t client;
static usb_device_handle_t dev = NULL;
static uint8_t ep_out = 0, iface_num = 0;
static volatile bool printer_ready = false;
static volatile uint8_t new_addr = 0;
static volatile bool dev_gone = false;
static SemaphoreHandle_t xfer_done, job_lock;
static usb_transfer_t *xfer;

WebServer http(80);
WiFiServer raw(RAW_PORT);

// ---- USB host -------------------------------------------------------------

// Runs the USB host library's own event loop forever.
void usbLibTask(void *) {
  usb_host_config_t cfg = { .skip_phy_setup = false, .intr_flags = ESP_INTR_FLAG_LEVEL1 };
  ESP_ERROR_CHECK(usb_host_install(&cfg));
  while (true) {
    uint32_t flags;
    usb_host_lib_handle_events(portMAX_DELAY, &flags);
  }
}

void clientEvent(const usb_host_client_event_msg_t *msg, void *) {
  if (msg->event == USB_HOST_CLIENT_EVENT_NEW_DEV) new_addr = msg->new_dev.address;
  else if (msg->event == USB_HOST_CLIENT_EVENT_DEV_GONE) dev_gone = true;
}

void xferDone(usb_transfer_t *) { xSemaphoreGive(xfer_done); }

// Walk the configuration descriptor for a Printer Class (0x07) interface
// and its bulk OUT endpoint, then claim it.
void openPrinter(uint8_t addr) {
  if (usb_host_device_open(client, addr, &dev) != ESP_OK) return;
  const usb_device_desc_t *dd;
  usb_host_get_device_descriptor(dev, &dd);
  Serial.printf("New USB device %04x:%04x\n", dd->idVendor, dd->idProduct);

  const usb_config_desc_t *cfg;
  usb_host_get_active_config_descriptor(dev, &cfg);
  const uint8_t *p = (const uint8_t *)cfg, *end = p + cfg->wTotalLength;
  bool inPrinter = false;
  uint8_t alt = 0;
  for (; p + 2 <= end && p[0]; p += p[0]) {
    if (p[1] == USB_B_DESCRIPTOR_TYPE_INTERFACE) {
      auto *i = (const usb_intf_desc_t *)p;
      Serial.printf("  interface %d class 0x%02x\n", i->bInterfaceNumber, i->bInterfaceClass);
      if (ep_out) break;
      inPrinter = i->bInterfaceClass == 0x07;
      iface_num = i->bInterfaceNumber;
      alt = i->bAlternateSetting;
    } else if (p[1] == USB_B_DESCRIPTOR_TYPE_ENDPOINT && inPrinter && !ep_out) {
      auto *e = (const usb_ep_desc_t *)p;
      if ((e->bmAttributes & 0x03) == 0x02 && !(e->bEndpointAddress & 0x80)) ep_out = e->bEndpointAddress;
    }
  }
  if (!ep_out) {
    Serial.println("No printer interface");
    usb_host_device_close(client, dev);
    dev = NULL;
    led(B, B, 0);
    return;
  }
  if (usb_host_interface_claim(client, dev, iface_num, alt) != ESP_OK) {
    Serial.println("Claim failed");
    return;
  }
  printer_ready = true;
  Serial.printf("Printer ready (interface %d, ep 0x%02x)\n", iface_num, ep_out);
  led(0, B, 0);
}

// Handles plug / unplug.
void clientTask(void *) {
  usb_host_client_config_t cfg = {
    .is_synchronous = false, .max_num_event_msg = 5,
    .async = { .client_event_callback = clientEvent, .callback_arg = NULL },
  };
  while (usb_host_client_register(&cfg, &client) != ESP_OK) vTaskDelay(pdMS_TO_TICKS(100));
  usb_host_transfer_alloc(CHUNK, 0, &xfer);
  while (true) {
    usb_host_client_handle_events(client, pdMS_TO_TICKS(50));
    if (new_addr) { uint8_t a = new_addr; new_addr = 0; if (!dev) openPrinter(a); }
    if (dev_gone) {
      dev_gone = false;
      if (dev) {
        printer_ready = false;
        if (ep_out) usb_host_interface_release(client, dev, iface_num);
        usb_host_device_close(client, dev);
        dev = NULL; ep_out = 0;
        Serial.println("Printer removed");
        led(B, B, 0);
      }
    }
  }
}

// One bulk OUT transfer; waits until the printer has taken it.
bool usbSend(const uint8_t *data, size_t n) {
  if (!printer_ready) return false;
  memcpy(xfer->data_buffer, data, n);
  xfer->num_bytes = n;
  xfer->device_handle = dev;
  xfer->bEndpointAddress = ep_out;
  xfer->callback = xferDone;
  xfer->timeout_ms = USB_TIMEOUT_MS;
  if (usb_host_transfer_submit(xfer) != ESP_OK) return false;
  if (xSemaphoreTake(xfer_done, pdMS_TO_TICKS(USB_TIMEOUT_MS)) != pdTRUE) return false;
  return xfer->status == USB_TRANSFER_STATUS_COMPLETED;
}

bool usbSendAll(const uint8_t *data, size_t n) {
  for (size_t off = 0; off < n; off += CHUNK)
    if (!usbSend(data + off, min((size_t)CHUNK, n - off))) return false;
  return true;
}

// ---- Port 9100: raw jobs from the Mac's driver ----------------------------

void rawTask(void *) {
  static uint8_t buf[CHUNK];
  while (true) {
    WiFiClient c = raw.accept();
    if (!c) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }
    if (!printer_ready) { c.stop(); continue; }  // refuse so macOS retries later
    xSemaphoreTake(job_lock, portMAX_DELAY);
    led(B, B, B);
    size_t total = 0; bool ok = true;
    // Read only after the last chunk reached the printer: TCP slows the Mac down for us.
    while (ok && (c.connected() || c.available())) {
      int n = c.read(buf, CHUNK);
      if (n > 0) { ok = usbSend(buf, n); total += n; }
      else vTaskDelay(pdMS_TO_TICKS(2));
    }
    c.stop();
    Serial.printf(ok ? "Job done, %u bytes\n" : "USB write failed after %u bytes\n", total);
    led(ok ? 0 : B, ok ? B : 0, 0);
    xSemaphoreGive(job_lock);
  }
}

// ---- HTTP /print: plain text from the Vyohm app ---------------------------

void handlePrint() {
  String text = http.arg("plain");
  if (text.isEmpty()) return http.send(400, "text/plain", "empty body");
  if (!printer_ready) return http.send(503, "text/plain", "no USB printer connected");

  // CRLF line endings and a form feed to eject the page.
  String job;
  job.reserve(text.length() + 64);
  for (char c : text) { if (c == '\n') job += "\r\n"; else if (c != '\r') job += c; }
  job += "\f";

  xSemaphoreTake(job_lock, portMAX_DELAY);
  led(B, B, B);
  bool ok = usbSendAll((const uint8_t *)job.c_str(), job.length());
  led(ok ? 0 : B, ok ? B : 0, 0);
  xSemaphoreGive(job_lock);
  Serial.printf("App job %s, %u bytes\n", ok ? "done" : "FAILED", job.length());
  if (ok) http.send(200, "text/plain", "sent " + String(job.length()));
  else http.send(502, "text/plain", "USB write to printer failed");
}

// ---- Boot ----------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(1500);
  led(0, 0, B);
  xfer_done = xSemaphoreCreateBinary();
  job_lock = xSemaphoreCreateMutex();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\nGot IP: %s\n", WiFi.localIP().toString().c_str());

  MDNS.begin("esp-printer");                    // esp-printer.local
  MDNS.addService("pdl-datastream", "tcp", RAW_PORT);  // how raw printers advertise to Macs
  MDNS.addServiceTxt("pdl-datastream", "tcp", "ty", "ESP32 Print Server");
  MDNS.addService("http", "tcp", 80);

  http.on("/ping", HTTP_GET, [] { http.send(200, "text/plain", printer_ready ? "ok printer" : "ok no-printer"); });
  http.on("/print", HTTP_POST, handlePrint);
  http.begin();
  raw.begin();

  xTaskCreatePinnedToCore(usbLibTask, "usb_lib", 4096, NULL, 5, NULL, 0);
  xTaskCreatePinnedToCore(clientTask, "usb_client", 4096, NULL, 5, NULL, 0);
  xTaskCreatePinnedToCore(rawTask, "raw9100", 8192, NULL, 4, NULL, 1);
  led(B, B, 0);  // yellow until a printer enumerates
  Serial.println("ready, waiting for printer");
}

void loop() { http.handleClient(); }
