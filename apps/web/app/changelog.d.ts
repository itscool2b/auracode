declare module "#changelog" {
  const days: readonly import("./changelog-types").ChangelogDay[];
  export default days;
}
