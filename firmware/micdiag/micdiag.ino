// Mic diagnostic that bypasses the Arduino I2S library: drives the INMP441 with Espressif's own
// i2s_std driver, and while the clocks run, samples the three signal pins directly.
// If SCK and WS toggle but SD never does, the mic is not answering and no software can change that.
// Wiring: VDD->3V3, GND->GND, L/R->GND, SCK->4, WS->5, SD->6.

#include <driver/i2s_std.h>
#include <driver/gpio.h>

gpio_num_t PIN_SCK = GPIO_NUM_4, PIN_WS = GPIO_NUM_5, PIN_SD = GPIO_NUM_6;
static int32_t samples[1600];  // 0.1 s at 16 kHz

i2s_chan_handle_t startI2s(bool msbFormat) {
  i2s_chan_handle_t rx;
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  ESP_ERROR_CHECK(i2s_new_channel(&chan, NULL, &rx));
  i2s_std_config_t cfg = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000),
    .slot_cfg = msbFormat ? (i2s_std_slot_config_t)I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO)
                          : (i2s_std_slot_config_t)I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = {.mclk = I2S_GPIO_UNUSED, .bclk = PIN_SCK, .ws = PIN_WS, .dout = I2S_GPIO_UNUSED, .din = PIN_SD,
                 .invert_flags = {false, false, false}},
  };
  cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(rx, &cfg));
  ESP_ERROR_CHECK(i2s_channel_enable(rx));
  // Let the pins be read back while the I2S peripheral drives them.
  gpio_input_enable(PIN_SCK);
  gpio_input_enable(PIN_WS);
  gpio_input_enable(PIN_SD);
  return rx;
}

// Counts level changes on a pin over a burst of fast reads.
int toggles(gpio_num_t pin) {
  int count = 0, last = gpio_get_level(pin);
  for (int i = 0; i < 20000; i++) {
    int now = gpio_get_level(pin);
    if (now != last) count++;
    last = now;
  }
  return count;
}

void runTest(bool msbFormat) {
  i2s_chan_handle_t rx = startI2s(msbFormat);
  size_t bytes;
  for (int i = 0; i < 4; i++) i2s_channel_read(rx, samples, sizeof(samples), &bytes, 1000);  // skip start-up
  int sck = toggles(PIN_SCK), ws = toggles(PIN_WS), sd = toggles(PIN_SD);
  i2s_channel_read(rx, samples, sizeof(samples), &bytes, 1000);
  int32_t lo = INT32_MAX, hi = INT32_MIN, nonzero = 0;
  for (size_t i = 0; i < bytes / 4; i++) {
    int32_t s = samples[i] >> 14;
    lo = min(lo, s);
    hi = max(hi, s);
    if (samples[i]) nonzero++;
  }
  Serial.printf("sck=%d ws=%d sd=%d ", PIN_SCK, PIN_WS, PIN_SD);
  Serial.printf("%s: SCK toggles %5d  WS toggles %5d  SD toggles %5d | samples %d nonzero %ld swing %ld\n",
                msbFormat ? "MSB    " : "Philips", sck, ws, sd, (int)(bytes / 4), (long)nonzero, (long)(hi - lo));
  i2s_channel_disable(rx);
  i2s_del_channel(rx);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
}

void loop() {
  // Tries every way the three signal wires could be spread over pins 4, 5 and 6.
  const gpio_num_t perms[6][3] = {{GPIO_NUM_4, GPIO_NUM_5, GPIO_NUM_6}, {GPIO_NUM_4, GPIO_NUM_6, GPIO_NUM_5},
                                  {GPIO_NUM_5, GPIO_NUM_4, GPIO_NUM_6}, {GPIO_NUM_5, GPIO_NUM_6, GPIO_NUM_4},
                                  {GPIO_NUM_6, GPIO_NUM_4, GPIO_NUM_5}, {GPIO_NUM_6, GPIO_NUM_5, GPIO_NUM_4}};
  for (auto &p : perms) {
    PIN_SCK = p[0];
    PIN_WS = p[1];
    PIN_SD = p[2];
    runTest(false);
  }
  Serial.println("--");
  delay(1000);
}
