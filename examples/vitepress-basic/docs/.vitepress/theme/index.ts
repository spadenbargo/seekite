import DefaultTheme from "vitepress/theme";
import { withSeekiteSearch } from "@seekite/vitepress/theme";
import "@seekite/vitepress/style.css";

export default withSeekiteSearch(DefaultTheme, {
  placeholder: "Search fixture docs…",
});
