import { AuthPage } from "./auth";
export const meta = () => [
  { title: "Create account · auracode" },
  { name: "robots", content: "noindex" },
];
export default function SignUp() {
  return <AuthPage signup />;
}
