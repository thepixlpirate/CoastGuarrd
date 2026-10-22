import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './auth';
import Login from './pages/Login';
import Register from './pages/Register';
import SetupWizard from './pages/SetupWizard';
import Shell from './components/Shell';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Rules from './pages/Rules';
import Leaving from './pages/Leaving';
import RecycleBin from './pages/RecycleBin';
import PublicLeaving from './pages/PublicLeaving';
import Live from './pages/Live';
import History from './pages/History';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import MapPage from './pages/MapPage';
import Requests from './pages/Requests';
import Alerts from './pages/Alerts';

export default function App() {
  const { status } = useAuth();
  const location = useLocation();

  // The family page works without signing in.
  const pub = location.pathname.match(/^\/public\/leaving\/([^/]+)/);
  if (pub) return <PublicLeaving token={decodeURIComponent(pub[1])} />;

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
        <Route path="/activity" element={<Live />} />
        <Route path="/history" element={<History />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/leaving" element={<Leaving />} />
        <Route path="/recycle" element={<RecycleBin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
