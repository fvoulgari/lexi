import { NavLink } from "react-router-dom";
import {
  House,
  Copy,
  BookOpen,
  ChartNoAxesCombined,
  UserRound,
} from "lucide-react";
import PropTypes from "prop-types";

export default function MobileNavigation({ text }) {
  const destinations = [
    { to: "/", Icon: House, label: text.home },
    { to: "/practice", Icon: Copy, label: text.mobilePractice },
    { to: "/vocabulary", Icon: BookOpen, label: text.mobileWords },
    { to: "/progress", Icon: ChartNoAxesCombined, label: text.mobileProgress },
    { to: "/settings", Icon: UserRound, label: text.mobileProfile },
  ];
  return (
    <nav className="mobile-navigation" aria-label={text.mobileNavigation}>
      {destinations.map(({ to, Icon, label }) => (
        <NavLink key={to} to={to} end={to === "/"}>
          <Icon size={23} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
MobileNavigation.propTypes = { text: PropTypes.object.isRequired };
