import { type FormEvent, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { LogIn } from "lucide-react";
import { trpc } from "../../trpc.ts";

interface LocalLoginFormProps {
  onSuccess: () => void;
}

export function LocalLoginForm({ onSuccess }: LocalLoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => onSuccess(),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ username, password });
  };

  // Parse rate limit retry info from error message
  const errorMessage = loginMutation.error
    ? formatError(loginMutation.error.message)
    : null;

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
      >
        <Text as="label" size="2" weight="medium">
          Username
        </Text>
        <TextField.Root
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
      </div>

      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}
      >
        <Text as="label" size="2" weight="medium">
          Password
        </Text>
        <TextField.Root
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      {errorMessage && (
        <Text as="p" size="2" color="red">
          {errorMessage}
        </Text>
      )}

      <Button
        type="submit"
        size="3"
        disabled={!username || !password || loginMutation.isPending}
      >
        <LogIn size={18} />
        {loginMutation.isPending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

function formatError(message: string): string {
  if (message === "invalid_credentials") {
    return "Invalid username or password";
  }
  // Rate limit response has JSON payload
  if (message.startsWith("{")) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.retryAfter) {
        const seconds = Math.ceil(parsed.retryAfter / 1000);
        return `Too many attempts. Try again in ${seconds} seconds.`;
      }
    } catch (e) {
      console.debug("Message is not JSON, using as-is:", e);
    }
  }
  return message;
}
