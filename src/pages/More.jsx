import { Navigate } from 'react-router-dom';

/** Alte Modul-Übersicht entfernt — Navigation läuft über Sidebar / Dock. */
export default function More() {
  return <Navigate to="/panel" replace />;
}
