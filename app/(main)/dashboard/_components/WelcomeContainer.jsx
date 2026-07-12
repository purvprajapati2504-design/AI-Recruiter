"use client";
import React, { useState } from "react";
import { useUser } from "@/app/provider";
import Link from "next/link";

const fallbackSvgDataUri = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><rect fill='%23F3F4F6' width='160' height='160'/><g fill='%239CA3AF'><circle cx='80' cy='54' r='28'/><rect x='30' y='92' width='100' height='40' rx='20'/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

function WelcomeContainer() {
  const { user } = useUser();
  const [avatarSrc, setAvatarSrc] = useState(user?.picture || fallbackSvgDataUri);

  React.useEffect(() => {
    const newSrc = user?.picture || fallbackSvgDataUri;
    console.log("WelcomeContainer - user.picture:", user?.picture);
    console.log("WelcomeContainer - setting avatarSrc to:", newSrc);
    setAvatarSrc(newSrc);
  }, [user?.picture]);

  const handleImageError = () => {
    console.log("WelcomeContainer - Image error, falling back to SVG");
    setAvatarSrc(fallbackSvgDataUri);
  };

  return (
    <div className="bg-white p-5 rounded-xl flex justify-between items-center">
    <div>
      <h2 className="text-lg font-bold">Welcome Back, {user?.name}</h2>
      <h2 className="text-gray-500">AI-Driven Interviews, Hassels-Free Hiring</h2>
    </div>
   <Link href="/settings" className="cursor-pointer">
    <img
      src={avatarSrc}
      alt="userAvatar"
      width={40}
      height={40}
      className="rounded-full"
      onError={handleImageError}
      style={{ width: 40, height: 40, objectFit: "cover" }}
    />
</Link>
    </div>
  );
}

export default WelcomeContainer;
