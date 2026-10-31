// A stand-in network printer: listens on raw port 9100 like a real one and
// prints each job to the terminal. Use it to test the ESP32 with no printer.
import net from 'node:net';

const port = Number(process.argv[2] ?? 9100);
net.createServer((sock) => {
  const chunks = [];
  sock.on('data', (c) => chunks.push(c));
  sock.on('end', () => {
    const job = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n').replace(/\f$/, '');
    console.log(`\n--- job from ${sock.remoteAddress} (${Buffer.concat(chunks).length} bytes) ---\n${job}\n--- end ---`);
  });
}).listen(port, '0.0.0.0', () => console.log(`fake printer listening on :${port}`));
