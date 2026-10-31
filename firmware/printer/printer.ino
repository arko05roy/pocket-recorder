// Print bridge. The app POSTs text to http://vyohm-printer.local/print?host=IP&port=9100
// and this board opens a raw TCP socket to the printer and streams the text.
// Port 9100 ("raw"/JetDirect) is what most network laser and office printers listen on.
// LED: blue = joining Wi-Fi, green = ready, white = printing, red = last job failed.

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "secrets.h"

const uint8_t B = 32;  // LED brightness
WebServer server(80);

void led(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(RGB_BUILTIN, r, g, b); }

void handlePrint() {
  String host = server.arg("host");
  int port = server.hasArg("port") ? server.arg("port").toInt() : 9100;
  String text = server.arg("plain");  // the raw request body
  if (host.isEmpty() || text.isEmpty()) {
    server.send(400, "text/plain", "need ?host= and a text body");
    return;
  }

  led(B, B, B);
  WiFiClient printer;
  if (!printer.connect(host.c_str(), port, 5000)) {
    led(B, 0, 0);
    Serial.printf("no printer at %s:%d\n", host.c_str(), port);
    server.send(502, "text/plain", "printer did not answer at " + host + ":" + String(port));
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
  server.send(200, "text/plain", "sent " + String(sent));
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

  server.on("/ping", HTTP_GET, [] { server.send(200, "text/plain", "ok"); });
  server.on("/print", HTTP_POST, handlePrint);
  server.begin();
  led(0, B, 0);
  Serial.println("ready");
}

void loop() { server.handleClient(); }
