/**
 * A gallery of real low-poly 3D models, all from a single CC0 pack so the whole set carries one
 * clear, attribution-free license (see public/assets/gallery/LICENSE.txt). The viewer reads each
 * model's stats live from the file, so nothing here is a hand-authored number to get wrong.
 */

export type GalleryCategory = 'Buildings' | 'Vehicles' | 'Roads' | 'Street props';

export interface GalleryModel {
  id: string;
  name: string;
  file: string;
  category: GalleryCategory;
}

export const GALLERY_LICENSE = {
  spdx: 'CC0 1.0',
  pack: 'KayKit · City Builder Bits',
  author: 'Kay Lousberg',
  url: 'https://kaylousberg.com',
  note: 'Public domain (CC0) — free for commercial use, attribution not required.',
} as const;

function model(id: string, name: string, category: GalleryCategory): GalleryModel {
  return { id, name, file: `/assets/gallery/${id}.glb`, category };
}

export const galleryModels: GalleryModel[] = [
  model('building_A', 'Building A', 'Buildings'),
  model('building_B', 'Building B', 'Buildings'),
  model('building_C', 'Building C', 'Buildings'),
  model('building_D', 'Building D', 'Buildings'),
  model('building_E', 'Building E', 'Buildings'),
  model('building_F', 'Building F', 'Buildings'),
  model('car_hatchback', 'Hatchback', 'Vehicles'),
  model('car_sedan', 'Sedan', 'Vehicles'),
  model('car_stationwagon', 'Station wagon', 'Vehicles'),
  model('car_taxi', 'Taxi', 'Vehicles'),
  model('car_police', 'Police car', 'Vehicles'),
  model('road_straight', 'Straight road', 'Roads'),
  model('road_corner', 'Road corner', 'Roads'),
  model('road_junction', 'Junction', 'Roads'),
  model('road_tsplit', 'T-junction', 'Roads'),
  model('road_straight_crossing', 'Crosswalk', 'Roads'),
  model('bench', 'Bench', 'Street props'),
  model('bush', 'Bush', 'Street props'),
  model('dumpster', 'Dumpster', 'Street props'),
  model('firehydrant', 'Fire hydrant', 'Street props'),
  model('streetlight', 'Street light', 'Street props'),
  model('trafficlight_A', 'Traffic light', 'Street props'),
  model('trash_A', 'Trash can', 'Street props'),
  model('watertower', 'Water tower', 'Street props'),
];

export const galleryCategories: GalleryCategory[] = ['Buildings', 'Vehicles', 'Roads', 'Street props'];
