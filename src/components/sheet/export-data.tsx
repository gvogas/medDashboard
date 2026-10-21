// Settings › Account › Data: download everything as a backup, or your items as a spreadsheet.

import { Button } from "./fields"
import { exportData, exportItemsCsv } from "@/data/actions"

export function ExportData() {
    return (
        <>
            <span className="flex flex-wrap gap-1.5">
                <Button variant="ghost" onClick={() => void exportData()}>Download my data</Button>
                <Button variant="ghost" onClick={() => void exportItemsCsv()}>Download items as CSV</Button>
            </span>
            <span className="text-[11.5px] text-muted-foreground">
                The backup (JSON) holds your courses, items, study history, achievements, settings, your classes and projects, and any edits not synced yet. The CSV opens in Excel, Numbers or Google Sheets.
            </span>
        </>
    )
}
