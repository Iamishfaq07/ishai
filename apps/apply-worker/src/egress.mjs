// A CONNECT proxy pins every browser connection to a checked public IP. Checking a URL in Playwright's request
// callback alone would still permit DNS rebinding. The API control channel never passes through this proxy.
import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";

const blocked = new net.BlockList();
for (const [ip, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],
  ["192.88.99.0",24],["168.63.129.16",32],["198.18.0.0",15],["198.51.100.0",24],
  ["203.0.113.0",24],["224.0.0.0",3]]) blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]]) blocked.addSubnet(ip, prefix, "ipv6");
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function publicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
  return false;
}

export async function publicEndpoint(hostname, resolver = lookup) {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((r) => !publicAddress(r.address))) throw new Error("Non-public destination.");
  return records[0];
}

export async function createEgressProxy() {
  const sockets = new Set();
  const server = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("connect", async (req, client, head) => {
    let upstream;
    try {
      const target = new URL(`https://${req.url}`);
      if (target.port && target.port !== "443" || target.username || target.password || target.pathname !== "/") throw new Error("Refused port.");
      const host = target.hostname.replace(/^\[|\]$/g, "");
      const endpoint = await publicEndpoint(host);
      if (client.destroyed) return;
      upstream = net.connect({ host: endpoint.address, family: endpoint.family, port: 443 });
      sockets.add(upstream);
      upstream.setTimeout(120_000, () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => { sockets.delete(upstream); client.destroy(); });
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
    } catch { upstream?.destroy(); client.destroy(); }
  });
  server.on("clientError", (_e, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((r) => server.close(r)); } };
}
