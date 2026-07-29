import { TopNav } from "@/components/editor/TopNav";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { StatusBar } from "@/components/editor/StatusBar";
import { EditorProvider } from "@/components/editor/EditorProvider";

export default function HomePage() {
  return (
    <EditorProvider>
      <TopNav />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftSidebar />
        <Canvas />
        <RightSidebar />
      </div>
      <StatusBar />
    </EditorProvider>
  );
}
