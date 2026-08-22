import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { BadCasesPage } from "./pages/BadCasesPage";
import { EvidencePage } from "./pages/EvidencePage";
import { OverviewPage } from "./pages/OverviewPage";
import { ProposalsPage } from "./pages/ProposalsPage";
import { ReleasesPage } from "./pages/ReleasesPage";
import { RunsPage } from "./pages/RunsPage";
import { SkillsPage } from "./pages/SkillsPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "bad-cases", element: <BadCasesPage /> },
      { path: "evidence", element: <EvidencePage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "proposals", element: <ProposalsPage /> },
      { path: "releases", element: <ReleasesPage /> },
    ],
  },
]);

export function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 4,
          colorPrimary: "#ff6b00",
          colorInfo: "#287e78",
          colorText: "#1d1d1f",
          fontSize: 13,
        },
        components: {
          Button: { controlHeight: 34 },
          Table: { cellPaddingBlock: 13, headerBg: "#f5f5f2", headerColor: "#5b5c57" },
        },
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}
