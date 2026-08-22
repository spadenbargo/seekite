import React from "react";
import SearchBar from "@theme/SearchBar";

export default function Home() {
  return (
    <>
      <SearchBar />
      <main data-seekite-body>
        <h1>Docusaurus versioned search</h1>
        <p>Seekite exposes local version and locale facets in the theme search bar.</p>
      </main>
    </>
  );
}
