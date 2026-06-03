import { HashRouter, Routes, Route } from 'react-router';
import Dashboard from './pages/Dashboard';
import { SidebarProvider } from './context/SidebarContext';
import { RetentionSettingsProvider } from './context/RetentionSettingsContext';

export default function App() {
  return (
    <HashRouter>
      <SidebarProvider>
        <RetentionSettingsProvider>
          <Routes>
            <Route path="/*" element={<Dashboard />} />
          </Routes>
        </RetentionSettingsProvider>
      </SidebarProvider>
    </HashRouter>
  );
}
