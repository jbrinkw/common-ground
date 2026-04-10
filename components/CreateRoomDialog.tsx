"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createRoom } from "@/app/room/[roomId]/actions";

export function CreateRoomDialog() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{
    inviteCode: string;
    inviteLink: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    const res = await createRoom(topic || undefined);
    if ("error" in res) {
      setError(res.error);
      setIsCreating(false);
      return;
    }

    setResult({
      inviteCode: res.inviteCode,
      inviteLink: `${window.location.origin}/join/${res.inviteToken}`,
    });
    setIsCreating(false);
    router.refresh();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Room Created</CardTitle>
          <CardDescription>
            Share the invite link or code with the other person.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Invite Link</p>
            <div className="flex gap-2">
              <Input value={result.inviteLink} readOnly className="text-xs" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(result.inviteLink)}
              >
                Copy
              </Button>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Invite Code</p>
            <div className="flex gap-2">
              <Input value={result.inviteCode} readOnly className="font-mono text-lg tracking-wider" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(result.inviteCode)}
              >
                Copy
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="What's this about? (optional)"
        className="min-h-[44px]"
      />
      <Button onClick={handleCreate} disabled={isCreating} className="w-full">
        {isCreating ? "Creating..." : "Create Room"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
