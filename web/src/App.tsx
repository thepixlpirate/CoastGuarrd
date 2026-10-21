import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import SetupWizard from './pages/SetupWizard';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import ComingSoon from './pages/ComingSoon';
import { navItems } from './nav';

export default function App() {
  const { status } = useAuth();

  if (!status) {
    return (
      <div className="backdrop auth-wrap">
        <Loader2 className="spin" color="var(--purple-strong)" />
      </div>
    );
  }
  if (status.needsAccount) return <Register />;
  if (!status.user) return <Login />;
  if (!status.setupComplete) return <SetupWizard />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings/*" element={<Settings />} />
        {navItems
          .filter((n) => n.phase)
          .map((n) => (
            <Route key={n.to} path={n.to} element={<ComingSoon item={n} />} />
          ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
