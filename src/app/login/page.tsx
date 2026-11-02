import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Keep one login flow so both URLs share the design and tab session handling.
  redirect("/");
}
