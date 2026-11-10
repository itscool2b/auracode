import { index, type RouteConfig, route } from "@react-router/dev/routes";
export default [
  index("pages/home.tsx"),
  route("download", "pages/download.tsx"),
  route("signin", "pages/auth.tsx"),
  route("signup", "pages/signup.tsx"),
  route("verify-device", "pages/verify-device.tsx"),
  route("account", "pages/account.tsx"),
  route("privacy", "pages/privacy.tsx"),
  route("terms", "pages/terms.tsx"),
  route("changelog", "pages/changelog.tsx"),
  route("remote", "pages/remote.tsx"),
] satisfies RouteConfig;
