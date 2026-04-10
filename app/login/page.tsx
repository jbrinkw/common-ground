import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel — brand & explanation */}
      <div className="lg:w-1/2 bg-[#1a2f2f] text-white p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute inset-0 opacity-[0.04]">
          <div className="absolute top-[10%] left-[5%] w-96 h-96 rounded-full border border-white/30" />
          <div className="absolute bottom-[15%] right-[10%] w-64 h-64 rounded-full border border-white/20" />
          <div className="absolute top-[40%] right-[20%] w-48 h-48 rounded-full bg-white/10" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#5bbfb5]" />
            <span className="text-sm tracking-[0.2em] uppercase text-[#5bbfb5]/80 font-[var(--font-body)]">
              CommonGround
            </span>
          </div>
        </div>

        <div className="relative z-10 my-auto py-12 lg:py-0">
          <h1 className="font-[var(--font-display)] text-4xl lg:text-6xl leading-[1.1] mb-8 tracking-tight">
            Disagree
            <br />
            <span className="text-[#5bbfb5]">better.</span>
          </h1>

          <p className="text-lg lg:text-xl text-white/70 max-w-md leading-relaxed font-light mb-10">
            Every message is reviewed by an AI moderator before it reaches the
            other person. No insults. No derailing. Just the argument.
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-[#5bbfb5]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[#5bbfb5] text-sm">1</span>
              </div>
              <div>
                <p className="text-white/90 font-medium">Create a room</p>
                <p className="text-white/50 text-sm">
                  Share an invite link or code with someone you disagree with
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-[#5bbfb5]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[#5bbfb5] text-sm">2</span>
              </div>
              <div>
                <p className="text-white/90 font-medium">Speak your mind</p>
                <p className="text-white/50 text-sm">
                  Write what you really think. The moderator checks tone, not opinions.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-[#5bbfb5]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[#5bbfb5] text-sm">3</span>
              </div>
              <div>
                <p className="text-white/90 font-medium">Find common ground</p>
                <p className="text-white/50 text-sm">
                  Established facts emerge as you both agree on claims
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-white/30 text-xs">
            Built with Claude AI moderation
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-background">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
