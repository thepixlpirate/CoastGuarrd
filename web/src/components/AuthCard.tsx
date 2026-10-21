import type { ReactNode } from 'react';

export default function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="backdrop auth-wrap">
      <main className="auth-card">
        <div className="auth-logo">
          <img src="/logo.png" alt="" />
          <div className="wordmark grad-text">CoastGuarrd</div>
        </div>
        <h1 className="auth-title">{title}</h1>
        {children}
        <div className="auth-foot">Protected by CoastGuarrd</div>
      </main>
    </div>
  );
}
