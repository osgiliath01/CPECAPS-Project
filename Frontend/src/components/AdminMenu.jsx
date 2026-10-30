import { useEffect, useRef, useState } from "react";
import avatar from "../assets/default_user.jpg";

export default function AdminMenu({ user, initial, onPassword, onUsers, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="adminmenu" ref={ref}>
      <button
        className="adminbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <img src={avatar} alt="" className="avatar-img" />
        <span className="adminname">{user.is_superuser ? "Admin" : user.name}</span>
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
          <path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <p className="dropname">
            {user.name}
            <span className="muted small"> @{user.username}</span>
          </p>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPassword();
            }}
          >
            Change password
          </button>
          {user.is_superuser && onUsers && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onUsers();
              }}
            >
              Manage users
            </button>
          )}
          <button role="menuitem" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}