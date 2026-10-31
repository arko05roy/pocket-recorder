// Print bridge.
//   - Every 30 s it says hello to the app (SERVER_URL/api/devices/hello), so the app
//     shows "ESP32 printer bridge connected" and knows this board's IP.
//   - GET /scan finds printers on the Wi-Fi: Bonjour/mDNS adverts plus a sweep of
//     the subnet for ports 9100 (raw), 631 (IPP) and 515 (LPD).
//   - GET /probe?host=&port= checks one printer answers (the app's Connect button).
//   - POST /print?host=&port= sends text to the printer over a raw port-9100 socket.
// LED: blue = joining Wi-Fi, green = ready, purple = scanning, white = printing, red = last job failed.

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <lwip/sockets.h>
#include "secrets.h"
#include "found.h"

const uint8_t B = 32;  // LED brightness
WebServer http(80);

void led(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(RGB_BUILTIN, r, g, b); }

// ---- IPP: send a page to a print queue (e.g. a Mac sharing its USB printer) --
// An IPP request is a small binary header plus the document, POSTed over HTTP.
// The Mac's driver (CUPS) turns the plain text into what the printer understands.

void ippAttr(String &b, uint8_t tag, const char *name, const String &value) {
  b += (char)tag;
  b += (char)0; b += (char)strlen(name); b += name;
  b += (char)(value.length() >> 8); b += (char)(value.length() & 0xff); b += value;
}

// Returns "" on success, or what went wrong.
String ippPrint(const String &host, int port, const String &queue, const String &title, const String &text) {
  String uri = "ipp://" + host + ":" + String(port) + "/printers/" + queue;
  String h;
  h += (char)0x02; h += (char)0x00;  // IPP version 2.0
  h += (char)0x00; h += (char)0x02;  // operation: Print-Job
  h += (char)0; h += (char)0; h += (char)0; h += (char)1;  // request id 1
  h += (char)0x01;                   // operation attributes follow
  ippAttr(h, 0x47, "attributes-charset", "utf-8");
  ippAttr(h, 0x48, "attributes-natural-language", "en");
  ippAttr(h, 0x45, "printer-uri", uri);
  ippAttr(h, 0x42, "requesting-user-name", "vyohm-esp32");
  ippAttr(h, 0x42, "job-name", title.isEmpty() ? String("Vyohm") : title);
  ippAttr(h, 0x49, "document-format", "text/plain");
  h += (char)0x03;                   // end of attributes; the document comes next

  WiFiClient c;
  if (!c.connect(host.c_str(), port, 5000)) return "print server did not answer at " + host + ":" + String(port);
  size_t len = h.length() + text.length();
  c.printf("POST /printers/%s HTTP/1.1\r\nHost: %s:%d\r\nContent-Type: application/ipp\r\nContent-Length: %u\r\nConnection: close\r\n\r\n",
           queue.c_str(), host.c_str(), port, len);
  c.write((const uint8_t *)h.c_str(), h.length());
  c.write((const uint8_t *)text.c_str(), text.length());

  // Read the HTTP status line, skip headers, then the IPP status code (bytes 2-3 of the body).
  unsigned long until = millis() + 10000;
  String status;
  while (millis() < until && c.connected() && !c.available()) delay(10);
  status = c.readStringUntil('\n');
  while (c.connected() || c.available()) { String line = c.readStringUntil('\n'); if (line == "\r" || line.isEmpty()) break; }
  uint8_t body[4] = {0};
  c.readBytes(body, 4);
  c.stop();
  if (status.indexOf(" 200") < 0) return "print server replied: " + status;
  uint16_t ipp = (body[2] << 8) | body[3];
  if (ipp > 0x00ff) return "print server refused the job (IPP status 0x" + String(ipp, HEX) + ")";
  return "";
}

void handlePrint() {
  String host = http.arg("host");
  int port = http.hasArg("port") ? http.arg("port").toInt() : 9100;
  String text = http.arg("plain");  // the raw request body
  if (host.isEmpty() || text.isEmpty()) {
    http.send(400, "text/plain", "need ?host= and a text body");
    return;
  }

  // Port 631 = IPP: hand the text to a print queue, which formats it for the printer.
  if (port == 631) {
    String queue = http.arg("queue");
    if (queue.isEmpty()) { http.send(400, "text/plain", "IPP needs ?queue="); return; }
    led(B, B, B);
    String err = ippPrint(host, port, queue, http.arg("title"), text);
    Serial.printf("IPP job to %s/%s: %s\n", host.c_str(), queue.c_str(), err.isEmpty() ? "accepted" : err.c_str());
    if (err.isEmpty()) { led(0, B, 0); http.send(200, "text/plain", "sent " + String(text.length())); }
    else { led(B, 0, 0); http.send(502, "text/plain", err); }
    return;
  }

  led(B, B, B);
  WiFiClient printer;
  if (!printer.connect(host.c_str(), port, 5000)) {
    led(B, 0, 0);
    Serial.printf("no printer at %s:%d\n", host.c_str(), port);
    http.send(502, "text/plain", "printer did not answer at " + host + ":" + String(port));
    return;
  }

  // Printers expect CRLF line endings; a bare LF "staircases" the text.
  String job;
  job.reserve(text.length() + 64);
  for (char c : text) {
    if (c == '\n') job += "\r\n";
    else if (c != '\r') job += c;
  }
  job += "\f";  // form feed: eject the page

  size_t sent = printer.write((const uint8_t*)job.c_str(), job.length());
  printer.flush();
  printer.stop();  // closing the socket tells the printer the job is complete

  Serial.printf("printed %u bytes to %s:%d\n", sent, host.c_str(), port);
  led(0, B, 0);
  http.send(200, "text/plain", "sent " + String(sent));
}

// ---- Hello / heartbeat to the app --------------------------------------

unsigned long lastHello = 0;

void hello() {
  HTTPClient h;
  h.setTimeout(3000);
  if (!h.begin(String(SERVER_URL) + "/api/devices/hello")) return;
  h.addHeader("Content-Type", "application/json");
  String body = String("{\"device_id\":\"esp-printer\",\"kind\":\"printer\",\"ip\":\"") +
                WiFi.localIP().toString() + "\",\"rssi\":" + WiFi.RSSI() + "}";
  int code = h.POST(body);
  if (code != 200) Serial.printf("hello -> %d (is the app running at %s?)\n", code, SERVER_URL);
  h.end();
}

// ---- Printer discovery ---------------------------------------------------

String jsonEsc(const String &v) {
  String o;
  for (char c : v) { if (c == '"' || c == '\\') o += '\\'; if ((uint8_t)c >= 0x20) o += c; }
  return o;
}

Found *findOrAdd(std::vector<Found> &list, IPAddress ip) {
  for (auto &f : list) if (f.ip == ip) return &f;
  list.push_back(Found{ip});
  return &list.back();
}

// Bonjour: printers that announce themselves (AirPrint/IPP, raw, LPD).
void mdnsScan(std::vector<Found> &list) {
  const char *types[][2] = {{"ipp", "tcp"}, {"pdl-datastream", "tcp"}, {"printer", "tcp"}};
  for (auto &t : types) {
    int n = MDNS.queryService(t[0], t[1]);
    for (int i = 0; i < n; i++) {
      IPAddress ip = MDNS.address(i);
      // Some hosts (Macs) answer the service query without their address; ask for it by name.
      if (ip == IPAddress(0, 0, 0, 0)) ip = MDNS.queryHost(MDNS.hostname(i), 2000);
      if (ip == IPAddress(0, 0, 0, 0)) continue;
      Found *f = findOrAdd(list, ip);
      String model = MDNS.txt(i, "ty");  // printers put their model name here
      if (f->name.isEmpty()) f->name = model.length() ? model : MDNS.hostname(i);
      String rp = MDNS.txt(i, "rp");     // the IPP queue path, e.g. printers/Brother_DCP_L2520D_series
      if (rp.startsWith("printers/") && f->queue.isEmpty()) f->queue = rp.substring(9);
      uint16_t port = MDNS.port(i);
      if (port == 9100) f->p9100 = true;
      if (port == 631) f->p631 = true;
      if (port == 515) f->p515 = true;
    }
  }
}

// Sweep every address on the /24 for the three printer ports, 8 sockets at a
// time with non-blocking connects, so the whole subnet takes ~10-20 s.
void portScan(std::vector<Found> &list) {
  IPAddress me = WiFi.localIP();
  const uint16_t ports[] = {9100};  // IPP printers and shared Mac queues announce themselves over mDNS
  struct Try { int fd; IPAddress ip; uint16_t port; };
  std::vector<Try> batch;
  auto flush = [&]() {
    unsigned long until = millis() + 400;
    while (millis() < until && !batch.empty()) {
      fd_set w; FD_ZERO(&w); int maxfd = 0;
      for (auto &t : batch) { FD_SET(t.fd, &w); maxfd = max(maxfd, t.fd); }
      timeval tv = {0, 50000};
      if (select(maxfd + 1, NULL, &w, NULL, &tv) <= 0) continue;
      for (auto it = batch.begin(); it != batch.end();) {
        if (!FD_ISSET(it->fd, &w)) { ++it; continue; }
        int err = 0; socklen_t len = sizeof(err);
        getsockopt(it->fd, SOL_SOCKET, SO_ERROR, &err, &len);
        if (!err) {
          Found *f = findOrAdd(list, it->ip);
          if (it->port == 9100) f->p9100 = true;
          if (it->port == 631) f->p631 = true;
          if (it->port == 515) f->p515 = true;
        }
        close(it->fd);
        it = batch.erase(it);
      }
    }
    for (auto &t : batch) close(t.fd);
    batch.clear();
  };
  for (int host = 1; host < 255; host++) {
    IPAddress ip(me[0], me[1], me[2], host);
    if (ip == me) continue;
    for (uint16_t port : ports) {
      int fd = socket(AF_INET, SOCK_STREAM, 0);
      if (fd < 0) { flush(); fd = socket(AF_INET, SOCK_STREAM, 0); if (fd < 0) continue; }
      fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
      sockaddr_in a = {};
      a.sin_family = AF_INET;
      a.sin_port = htons(port);
      a.sin_addr.s_addr = (uint32_t)ip;
      connect(fd, (sockaddr *)&a, sizeof(a));
      batch.push_back({fd, ip, port});
      if (batch.size() >= 8) flush();
    }
  }
  flush();
}

void handleScan() {
  led(B / 2, 0, B);
  std::vector<Found> list;
  mdnsScan(list);
  portScan(list);
  String out = "[";
  for (size_t i = 0; i < list.size(); i++) {
    auto &f = list[i];
    if (!(f.p9100 || f.p631 || f.p515)) continue;
    if (out.length() > 1) out += ",";
    out += "{\"ip\":\"" + f.ip.toString() + "\",\"name\":\"" + jsonEsc(f.name) + "\",\"queue\":\"" + jsonEsc(f.queue) + "\",\"ports\":[";
    String ps;
    if (f.p9100) ps += "9100,";
    if (f.p631) ps += "631,";
    if (f.p515) ps += "515,";
    ps.remove(ps.length() - 1);
    out += ps + "]}";
  }
  out += "]";
  Serial.printf("scan: %s\n", out.c_str());
  led(0, B, 0);
  http.send(200, "application/json", out);
}

void handleProbe() {
  String host = http.arg("host");
  int port = http.hasArg("port") ? http.arg("port").toInt() : 9100;
  WiFiClient c;
  bool ok = !host.isEmpty() && c.connect(host.c_str(), port, 3000);
  c.stop();
  http.send(ok ? 200 : 502, "text/plain", ok ? "ok" : "no answer from " + host + ":" + String(port));
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  led(0, 0, B);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int tries = 0; WiFi.status() != WL_CONNECTED; tries++) {
    delay(300);
    Serial.print(".");
    if (tries % 50 == 49) {  // every ~15 s, show what the board can actually see (2.4 GHz only)
      Serial.printf("\nstatus %d, can't join %s. Networks in range:\n", WiFi.status(), WIFI_SSID);
      WiFi.disconnect();
      delay(100);
      int n = WiFi.scanNetworks();
      for (int i = 0; i < n; i++) Serial.printf("  %s  ch%d  %ddBm\n", WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i));
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
  }
  Serial.printf("\nip %s\n", WiFi.localIP().toString().c_str());

  MDNS.begin("esp-printer");  // reachable as http://esp-printer.local
  MDNS.addService("http", "tcp", 80);

  http.on("/ping", HTTP_GET, [] { http.send(200, "text/plain", "ok"); });
  http.on("/print", HTTP_POST, handlePrint);
  http.on("/scan", HTTP_GET, handleScan);
  http.on("/probe", HTTP_GET, handleProbe);
  http.begin();
  led(0, B, 0);
  Serial.println("ready");
}

void loop() {
  http.handleClient();
  if (millis() - lastHello > 30000 || !lastHello) { lastHello = millis(); hello(); }
}
