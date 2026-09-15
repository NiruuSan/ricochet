import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FAQ } from "../content";

export function RulesView({ rules }: { rules: boolean }) {
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
      <Link href="/" className="btn btn-primary">
        Got it. Let’s play. <ArrowRight />
      </Link>
    </section>
  );
}
