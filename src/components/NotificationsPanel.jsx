import React, { useEffect, useState, useCallback, useRef, memo } from "react";
import {
  getNotifications,
  markAllRead,
  markNotificationRead,
  subscribeToNotifications,
} from "../lib/notifications";
import { formatDate } from "../lib/utils";

const ICONS = {
  pig_added: "🐷",
  mating_added: "❤️",
  farrowing_recorded: "🐣",
  weaning_recorded: "🍼",
  feed_logged: "🌾",
  low_stock: "⚠️",
  growth_recorded: "📏",
  mortality_recorded: "💀",
  health_recorded: "💉",
  health_treatment: "🩺",
  vaccination_due: "📅",
  vaccination_overdue: "🚨",
  missed_feeding: "🍽️",
};

const TITLES = {

  mating_added: "Mating Recorded",
  farrowing_recorded: "Farrowing Recorded",
  weaning_recorded: "Weaning Recorded",
  feed_logged: "Feed Logged",
  low_stock: "🔴 Low Stock Alert",
  growth_recorded: "Growth Recorded",
  mortality_recorded: "Mortality Reported",
  health_recorded: "Health Record Added",
  health_treatment: "Treatment Applied",
  vaccination_due: "Vaccination Due",
  vaccination_overdue: "Vaccination Overdue",
  missed_feeding: "Missed Feeding",
};

const isAlertType = (type) =>
  type === "low_stock" || type === "vaccination_overdue";

const NotificationsPanel = memo(
  ({ open, onClose, profile, onCountChange }) => {
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const isMounted = useRef(true);

    // Auto‑update unread count
    useEffect(() => {
      if (onCountChange) {
        const unread = notifications.filter((n) => !n.read).length;
        onCountChange(unread);
      }
    }, [notifications, onCountChange]);

    const loadNotifications = useCallback(async () => {
      if (!profile?.role) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getNotifications(profile.role);
        if (isMounted.current) setNotifications(data || []);
      } catch (err) {
        console.error("Failed to load notifications:", err);
        if (isMounted.current) {
          setError("Could not load notifications. Please try again.");
          setNotifications([]);
        }
      } finally {
        if (isMounted.current) setLoading(false);
      }
    }, [profile?.role]);

    useEffect(() => {
      isMounted.current = true;
      if (!open || !profile?.role) return;

      loadNotifications();

      const unsubscribe = subscribeToNotifications(profile.role, (newNotif) => {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === newNotif.id)) return prev;
          return [newNotif, ...prev];
        });
      });

      const handleRefresh = () => loadNotifications();
      window.addEventListener("refreshAllData", handleRefresh);

      return () => {
        isMounted.current = false;
        unsubscribe();
        window.removeEventListener("refreshAllData", handleRefresh);
      };
    }, [open, profile?.role, loadNotifications]);

    const handleMarkOneRead = useCallback(async (notif) => {
      if (notif.read) return;
      try {
        await markNotificationRead(notif.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
        );
      } catch (err) {
        console.error("Failed to mark as read:", err);
      }
    }, []);

    const handleMarkAllRead = useCallback(async () => {
      if (!profile?.role) return;
      try {
        await markAllRead(profile.role);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      } catch (err) {
        console.error("Failed to mark all as read:", err);
      }
    }, [profile?.role]);

    const unreadCount = notifications.filter((n) => !n.read).length;
    const renderIcon = (type) => ICONS[type] || "🔔";
    const renderTitle = (type) => TITLES[type] || "Notification";

    return (
      <>
        {open && (
          <div
            onClick={onClose}
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(3px)",
              zIndex: 1000,
            }}
          />
        )}

        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            maxWidth: 420,
            backgroundColor: "#fff",
            boxShadow: "-8px 0 32px rgba(0,0,0,0.15)",
            zIndex: 1001,
            transform: open ? "translateX(0)" : "translateX(100%)",
            visibility: open ? "visible" : "hidden",
            transition: open
              ? "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s 0s"
              : "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), visibility 0s 0.4s",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "linear-gradient(135deg,#ecfdf5,#f0fdf4)",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  margin: 0,
                  color: "#1f2937",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i className="fas fa-bell" style={{ color: "#10b981" }} />
                Notifications
              </h2>
              {unreadCount > 0 && (
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                  {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close notifications"
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#6b7280",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#f3f4f6";
                e.currentTarget.style.color = "#1f2937";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "white";
                e.currentTarget.style.color = "#6b7280";
              }}
            >
              <i className="fas fa-times" />
            </button>
          </div>

          {/* Toolbar */}
          <div
            style={{
              padding: "10px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #e5e7eb",
              backgroundColor: "#fafafa",
              gap: 12,
            }}
          >
            <button
              onClick={loadNotifications}
              title="Refresh"
              style={{
                background: "none",
                border: "none",
                color: "#6b7280",
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 8px",
                borderRadius: 6,
                transition: "background 0.15s",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.background = "#f3f4f6")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.background = "none")
              }
            >
              <i className="fas fa-sync-alt" /> Refresh
            </button>
            <button
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
              style={{
                background: "none",
                border: "none",
                color: unreadCount > 0 ? "#059669" : "#9ca3af",
                fontSize: 13,
                fontWeight: 600,
                cursor: unreadCount > 0 ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "color 0.2s",
              }}
            >
              <i className="fas fa-check-double" /> Mark all as read
            </button>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                <i
                  className="fas fa-spinner fa-pulse"
                  style={{
                    fontSize: 32,
                    marginBottom: 16,
                    color: "#10b981",
                    display: "block",
                  }}
                />
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  Loading notifications…
                </div>
              </div>
            ) : error ? (
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  color: "#dc2626",
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{error}</div>
                <button
                  onClick={loadNotifications}
                  style={{
                    marginTop: 16,
                    background: "#10b981",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 20px",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div
                style={{
                  padding: "80px 24px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                <div style={{ fontSize: 56, marginBottom: 20 }}>📭</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#374151" }}>
                  No notifications yet
                </div>
                <div style={{ fontSize: 15, marginTop: 6 }}>
                  You're all caught up!
                </div>
              </div>
            ) : (
              notifications.map((notif) => {
                const alert = isAlertType(notif.type);
                return (
                  <div
                    key={notif.id}
                    onClick={() => handleMarkOneRead(notif)}
                    title={notif.read ? "" : "Click to mark as read"}
                    style={{
                      padding: "18px 24px",
                      borderBottom: "1px solid #f3f4f6",
                      backgroundColor: notif.read
                        ? "#fff"
                        : alert
                          ? "#fff5f5"
                          : "#ecfdf5",
                      transition: "background-color 0.2s, filter 0.1s",
                      display: "flex",
                      gap: 14,
                      position: "relative",
                      cursor: notif.read ? "default" : "pointer",
                    }}
                    onMouseOver={(e) => {
                      if (!notif.read)
                        e.currentTarget.style.filter = "brightness(0.97)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.filter = "";
                    }}
                  >
                    {!notif.read && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 4,
                          borderRadius: "0 2px 2px 0",
                          backgroundColor: alert ? "#ef4444" : "#10b981",
                        }}
                      />
                    )}
                    <div
                      style={{
                        fontSize: 22,
                        flexShrink: 0,
                        width: 46,
                        height: 46,
                        backgroundColor: notif.read
                          ? "#f3f4f6"
                          : alert
                            ? "#fee2e2"
                            : "#d1fae5",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {renderIcon(notif.type)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 5,
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: notif.read ? 600 : 700,
                            color: "#1f2937",
                            fontSize: 14,
                          }}
                        >
                          {renderTitle(notif.type)}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexShrink: 0,
                          }}
                        >
                          {!notif.read && (
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                backgroundColor: alert ? "#ef4444" : "#10b981",
                                display: "inline-block",
                              }}
                            />
                          )}
                          <span
                            style={{
                              color: "#9ca3af",
                              fontSize: 11,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatDate(notif.created_at)}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          color: "#4b5563",
                          fontSize: 13,
                          lineHeight: 1.5,
                          marginBottom: 8,
                          wordBreak: "break-word",
                        }}
                      >
                        {notif.message}
                      </div>
                      <div
                        style={{
                          color: "#9ca3af",
                          fontSize: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>
                          {new Date(notif.created_at).toLocaleTimeString(
                            undefined,
                            { hour: "2-digit", minute: "2-digit" }
                          )}
                        </span>
                        {notif.actor_name && (
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <i className="fas fa-user-circle" style={{ opacity: 0.6 }} />
                            {notif.actor_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {!loading && notifications.length > 0 && (
            <div
              style={{
                padding: "12px 24px",
                borderTop: "1px solid #e5e7eb",
                fontSize: 12,
                color: "#9ca3af",
                textAlign: "center",
                backgroundColor: "#fafafa",
              }}
            >
              {notifications.length} notification
              {notifications.length !== 1 ? "s" : ""} total
              {unreadCount > 0
                ? ` · ${unreadCount} unread`
                : " · All read ✓"}
            </div>
          )}
        </div>
      </>
    );
  }
);

NotificationsPanel.displayName = "NotificationsPanel";

export default NotificationsPanel;