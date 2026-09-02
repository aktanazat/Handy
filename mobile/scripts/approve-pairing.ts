/**
 * Stand in for the operator's Mac during the simulator smoke: hand the phone's candidate
 * offer to the stub worker's `POST /v1/devices/pair`, which verifies the proof and seals
 * the pairing envelope.
 *
 * Run: bun mobile/scripts/approve-pairing.ts <offer.json> [endpoint]
 */
const [offerPath, endpoint = "http://127.0.0.1:8787"] = process.argv.slice(2);
if (offerPath === undefined)
  throw new Error("usage: approve-pairing.ts <offer.json>");

const response = await fetch(new URL("/v1/devices/pair", endpoint), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: await Bun.file(offerPath).text(),
});
console.log(response.status, await response.text());
if (!response.ok) process.exit(1);
