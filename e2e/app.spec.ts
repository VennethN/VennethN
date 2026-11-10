import { expect, test, type Page } from '@playwright/test'

async function openSample(page: Page, name = 'Student Survey') {
  await page.goto('/')
  await page.getByRole('dialog', { name: 'Welcome to VennStat' }).getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.locator('.statusbar')).toContainText('Cases: ')
}

async function menu(page: Page, ...path: string[]) {
  await page.locator('.menubar').getByRole('menuitem', { name: path[0], exact: true }).click()
  for (const [i, label] of path.slice(1).entries()) {
    const item = page.locator('.menu-pop .menu-item', { hasText: label }).first()
    if (i < path.length - 2) await item.hover()
    else await item.click()
  }
}

test('runs Frequencies from the dialog and shows SPSS-style tables', async ({ page }) => {
  await openSample(page)
  await menu(page, 'Analyze', 'Descriptive Statistics', 'Frequencies…')
  const dialog = page.getByRole('dialog', { name: 'Frequencies' })
  await dialog.getByRole('option', { name: 'Gender [gender]' }).dblclick()
  await dialog.getByRole('option', { name: 'Faculty [faculty]' }).dblclick()
  await dialog.getByRole('button', { name: 'Statistics…' }).click()
  await page.getByRole('dialog', { name: 'Frequencies: Statistics' }).getByLabel('Mean', { exact: true }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await dialog.getByRole('button', { name: 'OK' }).click()

  const pane = page.locator('.out-pane')
  await expect(pane.locator('.pt-title', { hasText: 'Statistics' })).toBeVisible()
  const gender = pane.locator('.pt', { has: page.locator('.pt-title', { hasText: /^Gender$/ }) })
  await expect(gender.locator('tbody')).toContainText('Male')
  await expect(gender.locator('tbody')).toContainText('100.0')
  await expect(pane.locator('.out-log').first()).toContainText('FREQUENCIES VARIABLES=gender faculty')
})

test('typing into an empty sheet creates variables and cases', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start with an empty dataset' }).click()
  await page.locator('.gcell').first().click()
  for (const v of ['12', '15', '9.5']) {
    await page.keyboard.type(v)
    await page.keyboard.press('Enter')
  }
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowRight')
  for (const v of ['a', 'b', 'a']) {
    await page.keyboard.type(v)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.statusbar')).toContainText('Cases: 3')
  await expect(page.locator('.statusbar')).toContainText('Variables: 2')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.statusbar')).toContainText('Variables: 2')
})

test('runs a syntax program with transformations and several procedures', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: /Syntax/ }).click()
  await page.getByLabel('Syntax editor').fill(`COMPUTE satisfaction = MEAN(sat1 TO sat5).
EXECUTE.
T-TEST GROUPS=gender(1 2) /VARIABLES=gpa.
ONEWAY gpa BY faculty /STATISTICS HOMOGENEITY /POSTHOC=TUKEY ALPHA(0.05).
REGRESSION /STATISTICS COEFF OUTS R ANOVA COLLIN TOL /DEPENDENT gpa /METHOD=ENTER hours_study sleep_hours stress /RESIDUALS DURBIN.
RELIABILITY /VARIABLES=sat1 TO sat5 /MODEL=ALPHA /SUMMARY=TOTAL.
GRAPH /SCATTERPLOT(BIVAR)=hours_study WITH gpa /FITLINE TOTAL.
`)
  await page.getByRole('button', { name: 'Run All' }).click()
  const pane = page.locator('.out-pane')
  for (const title of ['Independent Samples Test', 'Multiple Comparisons', 'Coefficients', 'Item-Total Statistics'])
    await expect(pane.locator('.pt-title', { hasText: title })).toBeVisible()
  await expect(pane.locator('svg[aria-label="Grade point average by Study hours per week"]')).toBeVisible()
  await expect(pane.locator('.out-text.error')).toHaveCount(0)
  // COMPUTE added a 19th variable (the grid only renders columns in view, so check the dictionary)
  await expect(page.locator('.statusbar')).toContainText('Variables: 19')
})

test('pasting from a dialog writes syntax to the Syntax Editor', async ({ page }) => {
  await openSample(page, 'Clinical Trial')
  await menu(page, 'Analyze', 'Compare Means', 'One-Way ANOVA…')
  const dialog = page.getByRole('dialog', { name: 'One-Way ANOVA' })
  await dialog.getByRole('option', { name: /Systolic BP at week 8/ }).click()
  await dialog.getByRole('button', { name: /Move selected variables to Dependent List/ }).click()
  await dialog.getByRole('option', { name: /Treatment arm/ }).click()
  await dialog.getByRole('button', { name: /Move selected variables to Factor/ }).click()
  await dialog.getByRole('button', { name: 'Paste' }).click()
  await expect(page.getByLabel('Syntax editor')).toHaveValue(/ONEWAY bp_week8 BY treatment/)
})
