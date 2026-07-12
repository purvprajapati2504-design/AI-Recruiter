"use client";

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/services/supabaseClient";
import { useUser } from "@/app/provider";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Edit2 } from "lucide-react";
import { useRouter } from "next/navigation";

const fallbackSvgDataUri = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><rect fill='%23F3F4F6' width='160' height='160'/><g fill='%239CA3AF'><circle cx='80' cy='54' r='28'/><rect x='30' y='92' width='100' height='40' rx='20'/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

function ResilientAvatar({ src, size = 56, alt = "avatar" }) {
  const [current, setCurrent] = useState(src || fallbackSvgDataUri);

  useEffect(() => {
    setCurrent(src || fallbackSvgDataUri);
  }, [src]);

  return (
    <img
      src={current}
      width={size}
      height={size}
      alt={alt}
      onError={() => setCurrent(fallbackSvgDataUri)}
      style={{ width: size, height: size, objectFit: "cover", borderRadius: 9999 }}
    />
  );
}

export default function SettingsPage() {
  const { user, setUser } = useUser();
  const router = useRouter();

  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState(0);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef("");

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
      setCredits(user.credits ?? 0);
      setAvatarPreview(user.picture ?? "");
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      if (error || !data?.user) {
        setFetching(false);
        return;
      }

      const authUser = data.user;
      const meta = authUser.user_metadata ?? {};
      const fallbackUser = {
        id: authUser.id,
        name:
          meta.full_name ||
          meta.name ||
          meta.given_name ||
          meta.nickname ||
          (authUser.email ? authUser.email.split("@")[0] : "users"),
        email: authUser.email ?? "",
        picture: meta.avatar_url || meta.picture || fallbackSvgDataUri,
        credits: 3,
      };

      setUser((prev) => ({ ...(prev || {}), ...fallbackUser }));
      setName(fallbackUser.name);
      setEmail(fallbackUser.email);
      setAvatarPreview(fallbackUser.picture);

      const { data: profile } = await supabase
        .from("users")
        .select("id, name, email, picture, credits")
        .eq("id", authUser.id)
        .maybeSingle();

      console.log("Settings - profile from database:", profile);

      if (!mounted) return;

      if (profile) {
        const merged = {
          id: profile.id,
          name: profile.name ?? fallbackUser.name,
          email: profile.email ?? fallbackUser.email,
          picture: profile.picture ?? fallbackUser.picture,
          credits: profile.credits ?? 3,
        };

        console.log("Settings - merged user:", merged);

        setUser((prev) => ({ ...(prev || {}), ...merged }));
        setName(merged.name);
        setEmail(merged.email);
        setCredits(merged.credits);
        setAvatarPreview(merged.picture);
      }

      setFetching(false);
    };

    loadProfile();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (!session?.user) {
        setUser(null);
        setName("");
        setEmail("");
        setCredits(0);
        setAvatarPreview("");
        return;
      }

      const authUser = session.user;
      const meta = authUser.user_metadata ?? {};
      const fallbackUser = {
        id: authUser.id,
        name:
          meta.full_name ||
          meta.name ||
          meta.given_name ||
          meta.nickname ||
          (authUser.email ? authUser.email.split("@")[0] : "User"),
        email: authUser.email ?? "",
        picture: meta.avatar_url || meta.picture || "/default-avatar.png",
        credits: 3,
      };

      setUser((prev) => ({ ...(prev || {}), ...fallbackUser }));
      setName(fallbackUser.name);
      setEmail(fallbackUser.email);
      setAvatarPreview(fallbackUser.picture);
      setCredits(fallbackUser.credits);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [setUser]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const uploadAvatarSafely = async (file) => {
    try {
      const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

      if (bucketError) return avatarPreview || fallbackSvgDataUri;

      const exists = buckets?.some((b) => b.name === "avatars");
      if (!exists) return avatarPreview || fallbackSvgDataUri;

      const ext = file.name.split(".").pop() || "png";
      const safeEmail = (email || "anon").replace(/[^a-zA-Z0-9-_.]/g, "_");
      const fileName = `${safeEmail}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("avatars").upload(fileName, file, {
        upsert: true,
        cacheControl: "3600",
      });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(fileName);
      return publicData?.publicUrl ?? avatarPreview ?? fallbackSvgDataUri;
    } catch (err) {
      console.error("Avatar upload error:", err);
      toast("Avatar upload failed");
      return avatarPreview || fallbackSvgDataUri;
    }
  };

  const onUpdateProfile = async () => {
    if (!user?.id) {
      toast("User not found");
      return;
    }

    if (!name.trim()) {
      toast("Name is required");
      return;
    }

    setLoading(true);
    try {
      let avatarUrl = avatarPreview || "";
      if (avatarFile) avatarUrl = await uploadAvatarSafely(avatarFile);

      const { data, error } = await supabase
        .from("users")
        .update({
          name: name.trim(),
          picture: avatarUrl,
        })
        .eq("id", user.id)
        .select("id, name, email, picture, credits")
        .maybeSingle();

      if (error) {
        console.error("Profile update error:", error);
        toast("Profile update failed");
        return;
      }

      if (data) {
        const merged = {
          id: data.id,
          name: data.name ?? name.trim(),
          email: data.email ?? email,
          picture: data.picture ?? avatarUrl,
          credits: data.credits ?? credits,
        };

        setUser((prev) => ({ ...(prev || {}), ...merged }));
        setName(merged.name);
        setEmail(merged.email);
        setAvatarPreview(merged.picture);
        setCredits(merged.credits);
      }

      setEditMode(false);
      toast("Profile updated successfully");
    } catch (err) {
      console.error("Unexpected update error:", err);
      toast("Profile update failed");
    } finally {
      setLoading(false);
      setAvatarFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    }
  };

  const handleChangeAccount = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast("Could not sign out");
        return;
      }
      setUser(null);
      router.replace("/auth");
    } catch (err) {
      console.error("Unexpected sign out error:", err);
      toast("Sign out failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;
    setAvatarFile(file);
    setAvatarPreview(previewUrl);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Account Settings</h1>
              <p className="text-sm text-gray-500">Manage your profile and account information</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-gray-100">
                <ResilientAvatar src={avatarPreview} size={56} alt="Profile avatar" />
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{name || user?.email || "User"}</p>
                <p className="text-xs text-gray-400">Credits: {credits}</p>
              </div>
            </div>
          </div>

          <hr className="my-6 border-gray-100" />

          {fetching ? (
            <div className="flex items-center justify-center py-8">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                {editMode ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onUpdateProfile();
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-sm font-medium mb-1">Full name</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="block w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        placeholder="Your full name"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Email</label>
                      <input
                        value={email}
                        readOnly
                        className="block w-full border rounded px-3 py-2 bg-gray-100 text-gray-500 cursor-not-allowed"
                        type="email"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Profile photo</label>
                      <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                          <ResilientAvatar src={avatarPreview} size={80} alt="avatar preview" />
                        </div>
                        <div className="flex flex-col gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                          />
                          <div className="text-xs text-gray-400">PNG, JPG up to 4MB</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button type="submit" disabled={loading}>
                        {loading ? "Saving..." : "Save changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditMode(false);
                          setAvatarFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-gray-500">Name</p>
                      <p className="font-medium">{name || "—"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Email</p>
                      <p className="font-medium">{email || "—"}</p>
                    </div>
                    <div className="pt-3">
                      <Button type="button" onClick={() => setEditMode(true)}>
                        <Edit2 className="w-4 h-4 mr-2" /> Edit profile
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <aside className="md:col-span-1 bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium mb-2">Account</h3>
                <div className="text-sm text-gray-600 mb-4">
                  Credits: <span className="font-medium">{credits}</span>
                </div>

                <div className="flex flex-col gap-2">
                  <Button type="button" variant="ghost" onClick={() => router.push("/billing")}>
                    Manage billing
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => router.push("/details")}>
                    See Details
                  </Button>
                  <Button type="button" variant="outline" onClick={handleChangeAccount} disabled={loading}>
                    {loading ? "Signing out..." : "Logout"}
                  </Button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}