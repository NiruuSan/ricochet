import { PaymentError } from "./errors";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// RPC URLs already proven to serve devnet in this process. A URL keeps pointing
// at the same cluster, so one genesis check per instance is enough.
const verified = new Set<string>();

export async function devnetConnection(url: string) {
  const connection = new Connection(url, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
  });
  if (!verified.has(url)) {
    if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new PaymentError("RPC cluster mismatch: only verified Solana devnet is allowed.");
    verified.add(url);
  }
  return connection;
}

export function recipientAddress(value: unknown) {
  if (typeof value !== "string") throw new PaymentError("Enter a Solana address.");
  let key: PublicKey;
  try {
    key = new PublicKey(value);
  } catch {
    throw new PaymentError("Invalid Solana address.");
  }
  if (!PublicKey.isOnCurve(key.toBytes())) throw new PaymentError("Use a standard Solana wallet address. Program addresses are not supported.");
  return key;
}

export function transferTransaction(source: PublicKey, destination: PublicKey, amount: number, id: string, blockhash: string) {
  return new Transaction({ feePayer: source, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: source, toPubkey: destination, lamports: amount }),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(`ricochet:${id}`) }),
  );
}

export async function prepareTransfer(connection: Connection, signer: Keypair, destination: PublicKey, amount: number, id: string, sweep = false) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
  let transaction = transferTransaction(signer.publicKey, destination, amount, id, blockhash);
  const fee = (await connection.getFeeForMessage(transaction.compileMessage(), "finalized")).value;
  if (fee === null || !Number.isSafeInteger(fee) || fee < 0 || fee > 1000000) throw new PaymentError("Unable to obtain an acceptable network fee.");
  // A deposit sweep sends the whole balance, so the fee comes out of it.
  const sentAmount = sweep ? amount - fee : amount;
  if (!Number.isSafeInteger(sentAmount) || sentAmount <= 0) throw new PaymentError("Deposit balance is too small to cover the network fee.");
  if (sweep) transaction = transferTransaction(signer.publicKey, destination, sentAmount, id, blockhash);
  transaction.sign(signer);
  if (!transaction.signature) throw new PaymentError("Transaction signing failed.");
  return {
    amount: sentAmount,
    fee,
    signature: bs58.encode(transaction.signature),
    wire: transaction.serialize().toString("base64"),
    lastValidBlockHeight,
  };
}
