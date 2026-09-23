"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateCcw } from "lucide-react";
import { FAQ } from "../content";
import { replayCoach } from "../coach";

export function RulesView({ rules }: { rules: boolean }) {
  const router = useRouter();
  return (
    <section className="subpage" style={{ maxWidth: 850 }}>
      <div className="tag lime" style={{ marginBottom: 12 }}>
        AIM HIGH. KNOW THE RULES.
      </div>
      <h1>{rules ? "The rules of the bounce." : "Good questions. Straight answers."}</h1>
      <p className="muted">Everything you need before your first run.</p>
      <div className="faq">
        {FAQ.map(([question, answer], i) => (
          <details key={question} open={i === 0}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
      <div className="row-actions" style={{ marginTop: 4 }}>
        <Link href="/" className="btn btn-primary">
          Got it. Let’s play. <ArrowRight />
        </Link>
        {/* The guide is shown once and then stays out of the way; this asks for it back. */}
        <button
          className="btn"
          onClick={() => {
            replayCoach();
            router.push("/");
          }}
        >
          <RotateCcw size={15} /> Show me on a board
        </button>
      </div>
    </section>
  );
}
