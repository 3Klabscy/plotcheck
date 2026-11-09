import "../lib/i18n";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AccountProvider } from "../lib/account";

export default function RootLayout() {
  return (
    <AccountProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </AccountProvider>
  );
}
