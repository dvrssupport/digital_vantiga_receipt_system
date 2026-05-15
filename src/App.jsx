import React, { useEffect } from "react";
import Routes from "./Routes";
import { supabase } from "./supabaseClient";
import { clearUserSession } from "./utils/auth";

function App() {
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "USER_DELETED") {
        clearUserSession();
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  return (
    <Routes />
  );
}

export default App;
