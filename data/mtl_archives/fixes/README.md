# Fix assets for MTL Archives dataset

- `VM97-3_05_186.TIF`: Original 300 dpi TIFF downloaded from `http://depot.ville.montreal.qc.ca/vues-aeriennes-1964/VM97-3_05_186.TIF`.
- `mtl_archives_image_9162.jpg`: JPEG generated via `sips -s format jpeg VM97-3_05_186.TIF --out mtl_archives_image_9162.jpg` to replace the zero-byte copy stored on the backup volume. Verify visually, then copy over `/Volumes/FREE SPACE/mtl_archives_photographs/mtl_archives_image_9162.jpg` once you are ready.
- `rename_plan.txt`: Suggested `cp` commands for creating `.jpg` companions for the five `.jpeg` files (`mtl_archives_image_10000`–`10004`). Run them manually after confirming the backup strategy you prefer.
