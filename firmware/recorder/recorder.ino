// H1: board alive. Cycles the onboard RGB LED red -> green -> blue and prints "ready".
// The ESP32-S3 DevKit has one WS2812 LED on GPIO 48 (RGB_BUILTIN in the core).

const uint8_t BRIGHTNESS = 32;  // 0-255; full brightness is painful to look at

void setup() {
  Serial.begin(115200);
  delay(1500);  // give the USB serial port time to appear on the Mac
  Serial.println("ready");
}

void loop() {
  rgbLedWrite(RGB_BUILTIN, BRIGHTNESS, 0, 0);
  delay(500);
  rgbLedWrite(RGB_BUILTIN, 0, BRIGHTNESS, 0);
  delay(500);
  rgbLedWrite(RGB_BUILTIN, 0, 0, BRIGHTNESS);
  delay(500);
}
