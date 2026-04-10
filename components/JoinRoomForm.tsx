"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinRoomByCode } from "@/app/room/[roomId]/actions";

export function JoinRoomForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError(null);

    const result = await joinRoomByCode(code.trim());
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/room/${result.roomId}`);
  };

  return (
    <form onSubmit={handleJoin} className="flex flex-wrap gap-2">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Invite code"
        className="font-mono tracking-wider w-28 sm:w-36 min-h-[44px]"
        maxLength={8}
      />
      <Button type="submit" variant="outline" disabled={loading || !code.trim()} className="min-h-[44px]">
        {loading ? "Joining..." : "Join"}
      </Button>
      {error && <p className="text-sm text-destructive w-full">{error}</p>}
    </form>
  );
}
