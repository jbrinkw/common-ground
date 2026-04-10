import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel — brand */}
      <div className="lg:w-1/2 bg-[#1a2f2f] text-white p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04]">
          <div className="absolute top-[10%] left-[5%] w-96 h-96 rounded-full border border-white/30" />
          <div className="absolute bottom-[15%] right-[10%] w-64 h-64 rounded-full border border-white/20" />
          <div className="absolute top-[40%] right-[20%] w-48 h-48 rounded-full bg-white/10" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-[#5bbfb5]" />
            <span className="text-sm tracking-[0.2em] uppercase text-[#5bbfb5]/80">
              CommonGround
            </span>
          </div>
        </div>

        <div className="relative z-10 my-auto py-12 lg:py-0">
          <h1 className="font-[var(--font-display)] text-4xl lg:text-6xl leading-[1.1] mb-8 tracking-tight">
            Every voice
            <br />
            <span className="text-[#5bbfb5]">deserves to be heard.</span>
          </h1>

          <p className="text-lg lg:text-xl text-white/70 max-w-md leading-relaxed font-light">
            CommonGround is a space where two people can disagree productively.
            An AI moderator reviews every message for tone — not opinions — so
            you can focus on the substance.
          </p>
        </div>

        <div className="relative z-10">
          <p className="text-white/30 text-xs">
            Built with Claude AI moderation
          </p>
        </div>
      </div>

      {/* Right panel — signup form */}
      <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-background">
        <SignupForm />
      </div>
    </div>
  );
}
