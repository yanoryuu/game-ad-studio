import { Editor } from "./components/Editor";
import { ProjectList } from "./components/ProjectList";
import { useHashRoute } from "./hooks/useHashRoute";

export function App() {
  const route = useHashRoute();
  if (route.page === "editor") return <Editor key={route.projectId} projectId={route.projectId} />;
  return <ProjectList />;
}
