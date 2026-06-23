import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const NAME_KEY = "sa.profileName";
const DEFAULT_NAME = "James";
const ProfileContext = createContext(null);

export function ProfileProvider({ children }) {
  const [name, setNameState] = useState(DEFAULT_NAME);

  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY)
      .then((savedName) => {
        if (savedName?.trim()) setNameState(savedName);
      })
      .catch(() => {});
  }, []);

  const setName = useCallback((nextName) => {
    setNameState(nextName);
    const trimmed = nextName.trim();
    if (trimmed) {
      AsyncStorage.setItem(NAME_KEY, trimmed).catch(() => {});
    } else {
      AsyncStorage.removeItem(NAME_KEY).catch(() => {});
    }
  }, []);

  const value = useMemo(() => ({ name, setName }), [name, setName]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error("useProfile must be used within ProfileProvider");
  return value;
}
