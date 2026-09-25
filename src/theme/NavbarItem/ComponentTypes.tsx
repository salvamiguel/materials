import ComponentTypes from '@theme-original/NavbarItem/ComponentTypes';
import PresentationNavbarItem from '@site/src/components/presentation/PresentationNavbarItem';

// Adds the `custom-presentation` navbar item type used in docusaurus.config.ts.
export default {
  ...ComponentTypes,
  'custom-presentation': PresentationNavbarItem,
};
