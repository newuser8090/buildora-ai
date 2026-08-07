import type { Metadata } from "next";
import { Layout } from "@/components/layout/Layout";
import { AuthProvider } from "@/features/auth/auth-provider";
import { CloudSyncProvider } from "@/features/cloud-sync/cloud-sync-provider";
import { geistSans, geistMono } from "@/lib/fonts";
import { APP_NAME, APP_DESCRIPTION } from "@/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_DESCRIPTION}`,
    template: `%s — ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <AuthProvider>
          <CloudSyncProvider>
            <Layout>{children}</Layout>
          </CloudSyncProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
