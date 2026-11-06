import type { IncomingMessage } from "node:http";
import type { RoomIdentity } from "@/lib/rooms/types";
import { RoomError } from "./store";

/** Only this credential is sent to IAM; client-supplied identity headers never grant access. */
export async function roomIdentity(
  request: IncomingMessage,
  fetcher = fetch,
): Promise<RoomIdentity | undefined> {
  const cookies = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("__Secure-krahsu-iam="));
  if (cookies.length !== 1 || cookies[0] === "__Secure-krahsu-iam=") return undefined;
  let response: Response;
  try {
    response = await fetcher("http://127.0.0.1:9091/auth/api/authz/auth-request", {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
      headers: {
        Cookie: cookies[0],
        Host: "iam.krahsu.top",
        "X-Original-URL": "https://iam.krahsu.top/api/overview",
        "X-Original-Method": "GET",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "iam.krahsu.top",
        "X-Forwarded-For": "127.0.0.1",
      },
    });
    await response.arrayBuffer();
  } catch {
    throw new RoomError(503, "IAM is temporarily unavailable. Try again shortly.");
  }
  if (response.status === 401 || response.status === 403) return undefined;
  if (response.status !== 200)
    throw new RoomError(503, "IAM is temporarily unavailable. Try again shortly.");
  const username = response.headers.get("remote-user");
  const groups = (response.headers.get("remote-groups") ?? "")
    .split(",")
    .map((group) => group.trim());
  if (!username || !groups.includes("owner")) return undefined;
  return { username, name: response.headers.get("remote-name") || username };
}
