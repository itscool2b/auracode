import { AuthPage } from "./auth";
export const meta = () => [
  { title: "Private preview · auracode" },
  { name: "robots", content: "noindex" },
];
export default function SignUp() {
  return <AuthPage signup />;
}
