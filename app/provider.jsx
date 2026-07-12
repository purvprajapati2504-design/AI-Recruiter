"use client";

import React, { useEffect, useState, useContext, useCallback } from "react";
import { supabase } from "@/lib/services/supabaseClient";
import { UserDetailContext } from "./context/UserDetailContext";

const fallbackSvgDataUri = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><rect fill='%23F3F4F6' width='160' height='160'/><g fill='%239CA3AF'><circle cx='80' cy='54' r='28'/><rect x='30' y='92' width='100' height='40' rx='20'/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

function mapAuthUser(authUser) {
  const meta = authUser?.user_metadata ?? {};
  const fallbackName =
    (authUser?.email && authUser.email.split("@")[0]) || "User";

  const pictureUrl = meta.avatar_url || meta.picture || "";
  const isValidPicture = pictureUrl && typeof pictureUrl === 'string' && pictureUrl.length > 0;

  console.log("mapAuthUser - meta:", meta);
  console.log("mapAuthUser - pictureUrl:", pictureUrl);
  console.log("mapAuthUser - isValidPicture:", isValidPicture);

  return {
    id: authUser?.id ?? null,
    name:
      meta.full_name ||
      meta.name ||
      meta.given_name ||
      meta.nickname ||
      fallbackName,
    email: authUser?.email ?? "",
    picture: isValidPicture ? pictureUrl : fallbackSvgDataUri,
  };
}

function Provider({ children }) {
  const [user, setUser] = useState(null);

  const loadCurrentUser = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data?.user) {
        setUser(null);
        return null;
      }

      const authUser = data.user;
      const fallbackUser = mapAuthUser(authUser);

      setUser(fallbackUser);

      try {
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("id, name, email, picture, credits")
          .eq("id", authUser.id)
          .maybeSingle();

        console.log("Profile fetch result:", { profile, profileError });

        if (!profileError && profile) {
          setUser(profile);
          return profile;
        }

        // User doesn't exist in database, create them
        if (!profileError && !profile) {
          console.log("User not found in database, creating new user with:", {
            id: authUser.id,
            name: fallbackUser.name,
            email: fallbackUser.email,
            picture: fallbackUser.picture
          });

          const { data: newProfile, error: insertError } = await supabase
            .from("users")
            .insert({
              id: authUser.id,
              name: fallbackUser.name,
              email: fallbackUser.email,
              picture: fallbackUser.picture,
              credits: 3
            })
            .select("id, name, email, picture, credits")
            .maybeSingle();

          console.log("User creation result:", { newProfile, insertError });

          if (!insertError && newProfile) {
            setUser(newProfile);
            return newProfile;
          } else {
            console.error("User creation failed:", insertError);
            console.error("User creation failed - message:", insertError?.message);
            console.error("User creation failed - code:", insertError?.code);
            console.error("User creation failed - details:", insertError?.details);
            console.error("User creation failed - hint:", insertError?.hint);
          }
        } else if (profileError) {
          console.error("Profile fetch error:", profileError);
        }
      } catch (profileErr) {
        console.error("Profile fetch exception:", profileErr);
      }

      return fallbackUser;
    } catch (err) {
      console.warn("loadCurrentUser failed:", err);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!mounted) return;
      await loadCurrentUser();
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (!mounted) return;

        if (session?.user) {
          const authUser = session.user;
          const fallbackUser = mapAuthUser(authUser);

          setUser(fallbackUser);

          try {
            const { data: profile, error: profileError } = await supabase
              .from("users")
              .select("id, name, email, picture, credits")
              .eq("id", authUser.id)
              .maybeSingle();

            console.log("Auth state change - Profile fetch result:", { profile, profileError });

            if (!profileError && profile) {
              setUser(profile);
            }

            // User doesn't exist in database, create them
            if (!profileError && !profile) {
              console.log("Auth state change - User not found in database, creating new user with:", {
                id: authUser.id,
                name: fallbackUser.name,
                email: fallbackUser.email,
                picture: fallbackUser.picture
              });

              const { data: newProfile, error: insertError } = await supabase
                .from("users")
                .insert({
                  id: authUser.id,
                  name: fallbackUser.name,
                  email: fallbackUser.email,
                  picture: fallbackUser.picture,
                  credits: 3
                })
                .select("id, name, email, picture, credits")
                .maybeSingle();

              console.log("Auth state change - User creation result:", { newProfile, insertError });

              if (!insertError && newProfile) {
                setUser(newProfile);
              } else {
                console.error("Auth state change - User creation failed:", insertError);
                console.error("Auth state change - User creation failed - message:", insertError?.message);
                console.error("Auth state change - User creation failed - code:", insertError?.code);
                console.error("Auth state change - User creation failed - details:", insertError?.details);
                console.error("Auth state change - User creation failed - hint:", insertError?.hint);
              }
            } else if (profileError) {
              console.error("Auth state change - Profile fetch error:", profileError);
            }
          } catch (profileErr) {
            console.error("Auth state change - Profile fetch exception:", profileErr);
          }
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error("Auth state change handler error:", err);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, [loadCurrentUser]);

  return (
    <UserDetailContext.Provider value={{ user, setUser }}>
      {children}
    </UserDetailContext.Provider>
  );
}

export default Provider;
export const useUser = () => useContext(UserDetailContext);