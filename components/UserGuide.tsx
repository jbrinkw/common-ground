"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function UserGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
        How it works
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Modal */}
          <div
            className="relative bg-background rounded-xl border shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 lg:p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-[var(--font-display)] text-2xl">How CommonGround Works</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-6">
                <section>
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-[#2d8282] mb-2">
                    The Concept
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    CommonGround is a space for two people to disagree productively.
                    Every message you send is reviewed by an AI moderator before the
                    other person sees it. The moderator checks for tone — not opinions.
                  </p>
                </section>

                <section>
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-[#2d8282] mb-3">
                    Getting Started
                  </h3>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#2d8282]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[#2d8282] text-xs font-medium">1</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <strong className="text-foreground">Create a room</strong> and share
                        the invite link or code with the person you want to talk to.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#2d8282]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[#2d8282] text-xs font-medium">2</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <strong className="text-foreground">Write your message.</strong> It
                        gets sent to the AI moderator first, not directly to the other person.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#2d8282]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[#2d8282] text-xs font-medium">3</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <strong className="text-foreground">If approved,</strong> your message
                        appears in the conversation. If flagged, you get feedback and can revise
                        (up to 5 attempts).
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-[#2d8282] mb-2">
                    Moderation Rules
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    The moderator will flag messages that:
                  </p>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">-</span>
                      Contain personal attacks or insults
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">-</span>
                      Use profanity or slurs
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">-</span>
                      Contradict established facts
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">-</span>
                      Go off-topic or derail the conversation
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-destructive mt-0.5">-</span>
                      Misrepresent the other person&apos;s position
                    </li>
                  </ul>
                </section>

                <section>
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-[#2d8282] mb-2">
                    Established Facts
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    As the conversation progresses, the moderator identifies points both
                    parties agree on and adds them to the &ldquo;Established Facts&rdquo;
                    sidebar. These become shared context that neither side can contradict.
                  </p>
                </section>
              </div>

              <div className="mt-8 pt-4 border-t">
                <Button onClick={() => setOpen(false)} className="w-full">
                  Got it
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
