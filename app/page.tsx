"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createRoom } from "@/app/room/[roomId]/actions";

export default function Home() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [joinLink, setJoinLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setError(null);

    const result = await createRoom();

    if ("error" in result) {
      setError(result.error);
      setIsCreating(false);
      return;
    }

    const roomUrl = `/room/${result.roomId}`;
    setJoinLink(`${window.location.origin}${roomUrl}?user=B`);
    router.push(`${roomUrl}?user=A`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">CommonGround</CardTitle>
          <CardDescription>
            A moderated space for productive disagreements. Every message is
            reviewed by an AI moderator before it reaches the other person.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <Button
            onClick={handleCreateRoom}
            disabled={isCreating}
            size="lg"
            className="w-full"
          >
            {isCreating ? "Creating room..." : "Create a Room"}
          </Button>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {joinLink && (
            <div className="w-full p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">
                Share this link with the other person:
              </p>
              <code className="text-xs break-all">{joinLink}</code>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
