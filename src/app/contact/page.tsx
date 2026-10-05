import type { Metadata } from "next";

import ContactForm from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with PFC in Bothasig, Cape Town. Book a free trial session.",
};

export const dynamic = "force-dynamic";

export default function ContactPage() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Get in touch</p>
          <h2>Contact us</h2>
          <p className="lead">
            Ready to start your journey? We&apos;d love to hear from you.
          </p>
        </div>

        <ContactForm />
      </div>
    </section>
  );
}
