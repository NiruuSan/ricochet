// Sign In With Solana, the message both ends agree on. No imports, so the page
// and the server read and write exactly the same text.
//
// A wallet that implements `solana:signIn` writes this message itself, from the
// fields it is given, and checks the domain against the page asking for it, so
// a look-alike site cannot reuse a Bounce challenge. A wallet that only signs
// messages is handed the same text, written here.

export type WalletChallenge = {
  domain: string;
  uri: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  version: "1";
};

/** The text of a sign-in, in the order the Sign In With Solana standard writes it. */
export function signInText(challenge: WalletChallenge, address: string) {
  const fields = [
    `URI: ${challenge.uri}`,
    `Version: ${challenge.version}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expiration Time: ${challenge.expirationTime}`,
  ];
  return `${challenge.domain} wants you to sign in with your Solana account:\n${address}\n\n${challenge.statement}\n\n${fields.join("\n")}`;
}

export type SignedIn = { domain: string; address: string; nonce: string; issuedAt: string | null; expirationTime: string | null };

/**
 * Reads back the fields that matter from a signed sign-in, whichever wallet
 * wrote it. Null when it is not a sign-in at all.
 */
export function readSignIn(text: string): SignedIn | null {
  const lines = text.split("\n");
  const head = /^([^\s]+) wants you to sign in with your Solana account:$/.exec(lines[0] ?? "");
  const address = lines[1] ?? "";
  if (!head || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  const field = (name: string) => {
    const line = lines.find((l) => l.startsWith(`${name}: `));
    return line ? line.slice(name.length + 2) : null;
  };
  const nonce = field("Nonce");
  if (!nonce || !/^[A-Za-z0-9]{8,64}$/.test(nonce)) return null;
  return { domain: head[1], address, nonce, issuedAt: field("Issued At"), expirationTime: field("Expiration Time") };
}
