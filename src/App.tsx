import { HashRouter, Routes, Route } from 'react-router';
import Dashboard from './pages/Dashboard';
import { SidebarProvider } from './context/SidebarContext';

export default function App() {
  return (
    <HashRouter>
      <SidebarProvider>
        <Routes>
          <Route path="/*" element={<Dashboard />} />
        </Routes>
      </SidebarProvider>
    </HashRouter>
  );
}
