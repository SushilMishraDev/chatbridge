import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ImportPage from "./pages/Import";

const loggedIn = () => !!localStorage.getItem("token");
const Private = ({ children }) => (loggedIn() ? children : <Navigate to="/login" />);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Dashboard /></Private>} />
        <Route path="/chat/:id" element={<Private><Dashboard /></Private>} />
        <Route path="/import" element={<Private><ImportPage /></Private>} />
      </Routes>
    </BrowserRouter>
  );
}
