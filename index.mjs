import puppeteer from 'puppeteer';
import fs from 'fs/promises'

import URLS from './URLS.mjs'
import QUESTION_TYPES from './QUESTION_TYPES.mjs'

let ARR = []
main()
async function main() {
    const cookies = JSON.parse(await fs.readFile('COOKIE'))
    const browser = await puppeteer.launch({
        headless: false, defaultViewport: {
            width: 1700,
            height: 1080
        }
    });
    const page = await browser.newPage();
    const acceptBeforeUnload = dialog =>
        // dialog.type() === "beforeunload" && dialog.accept()
        dialog.accept()
    page.on("dialog", acceptBeforeUnload);

    await page.setCookie(...cookies)

    await page.exposeFunction("addArr", (item) => { ARR.push(item) });
    await page.exposeFunction("setCookie", setCookie);
    await page.exposeFunction("getQuestionTypes", () => QUESTION_TYPES);

    await runPuppet(page)

    async function setCookie() {
        const cookies = await page.cookies();
        fs.writeFile('COOKIE', JSON.stringify(cookies), (err) => {
            if (err) console.error('err writing cookies')
            else console.log('cookies wrote to file')
        })
        page.off('framenavigated')
    }
}

async function runPuppet(page) {
    for (const URL of URLS) {
        try {
            await page.goto(URL, { waitUntil: 'load' });
            const jobTitle = await page.evaluate(() => document.querySelector('.jobsearch-JobInfoHeader-title')?.innerHTML.match(/(<.*>)?([a-zA-Z ]+)/)[2] || new Date().toLocaleString())
            const company = await page.evaluate(() => document.querySelector('div[data-company-name]')?.innerHTML.match(/(<.*>)?([a-zA-Z ]+)/)[2] || '')
            const isApplyCompanySite = await page.evaluate(() => /Apply on company site/i.test(document.querySelector('#applyButtonLinkContainer')?.innerHTML))

            if (isApplyCompanySite) {
                await fs.appendFile('COMPANY_URLS', '\n' + JSON.stringify({ url: URL }) + ',')
                continue
            }
            //check apply button is disabled
            const isApplyDisabled = await page.evaluate(() => document.querySelector('#indeedApplyButton')?.hasAttribute('disabled'))
            if (isApplyDisabled) {
                await fs.appendFile('ERROR_URLS', '\n' + JSON.stringify({ msg: 'applied', url: URL }) + ',')
                continue
            }
            await page.click('#indeedApplyButton')
            await page.waitForNavigation()

            const needToLogin = await page.evaluate(() => !!document.querySelector('input[type=email]'))
            if (!needToLogin) await fillForms()
            else {
                page.on("framenavigated", async (frame) => {
                    const url = frame.url();
                    if (!/secure.indeed.com\/auth/i.test(url)) {
                        await wait(3000)
                        await page.evaluate(createUserControls)
                    }
                });
                break
            }

            async function fillForms() {
                let intervalId
                let preUrl
                await new Promise((resolve, reject) => {
                    intervalId = setInterval(async () => {
                        try {
                            ARR = []
                            const currentUrl = await page.evaluate(() => document.location.href);
                            if (currentUrl == preUrl) {
                                throw new Error('fail submitting')
                            }
                            else preUrl = currentUrl
                            await page.evaluate(autoFillForms)
                            console.log(ARR);
                            for (const { id, classname, checked, value, selectValue } of ARR) {
                                if (id) {
                                    if (selectValue) await page.select('#' + id, selectValue)
                                    if (checked) await page.click('#' + id)
                                    if (value) await page.type('#' + id, value)
                                }

                            }
                            const isSubmitAppBtn = await page.evaluate(() => /Submit your application/i.test(document.querySelector('.ia-continueButton')?.innerHTML))
                            await page.click('.ia-continueButton')
                            if (isSubmitAppBtn) {
                                await page.screenshot({ path: [jobTitle, company].join('-') + '.png', type: 'png', fullPage: true });
                                await fs.appendFile('SUCCESS_URLS', '\n' + JSON.stringify({ url: URL }) + ',')
                                clearInterval(intervalId)
                                resolve()
                            }

                        } catch (error) {
                            clearInterval(intervalId)
                            console.log('EXIT INTERVAL', error.message);
                            reject(error)
                        }

                    }, 3000)
                })
            }
        }
        catch (error) {
            await fs.appendFile('ERROR_URLS', '\n' + JSON.stringify({ msg: error.message, url: URL, }) + ',')

        }
    }

    console.log('done');
}

async function autoFillForms() {
    const QUESTION_TYPES = await getQuestionTypes()
    const elements = document.querySelectorAll('.ia-Questions-item')
    for (const el of elements) {
        let useDefault = true
        if (/optional/i.test(el.innerHTML)) continue
        for (const { regex, checked, value, select } of QUESTION_TYPES) {
            if (!new RegExp(regex, 'i').test(el.innerHTML)) continue
            const textarea = el.querySelector('textarea')
            if (select) {
                const selectEl = el.querySelector('select')
                const options = el.querySelectorAll('option')
                for (const option of options) {
                    if (select.test(option.innerHTML)) {
                        const obj = {}
                        const id = selectEl.id
                        const classes = selectEl.classList
                        if (id) obj.id = id
                        else if (classes?.length) selectEl.classname = classes[0]
                        obj.selectValue = option.value
                        addArr(obj)
                        useDefault = false
                        break
                    }
                }
            }
            else if (textarea) {
                const obj = {}
                const input = textarea
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = value
                addArr(obj)
                useDefault = false
            }
            else {
                const inputs = el.querySelectorAll('input')
                if (!inputs.length) continue
                if (inputs[0].type === 'radio') {
                    // select yes
                    for (const input of inputs) {
                        if (checked && /1|Yes|true/i.test(input.value)) {
                            input.click()
                            useDefault = false

                        }
                        else if (/0|no|false/i.test(input.value)) {
                            input.click()
                            useDefault = false
                        }
                    }
                }
                else if (!inputs[0].value && ['text', 'number'].includes(inputs[0].type)) {
                    const obj = {}
                    const input = inputs[0]
                    const id = input.id
                    const classes = input.classList
                    if (id) obj.id = id
                    else if (classes.length) input.classname = classes[0]
                    obj.value = value
                    addArr(obj)
                    useDefault = false
                    // inputs[0].value = value
                }

            }

        }

        if (useDefault) {
            const inputs = el.querySelectorAll('input')
            if (!inputs.length) continue
            if (inputs[0].type === 'radio') {
                // select no
                for (const input of inputs) {
                    if (input.value == '0') {
                        input.click()
                    }
                }
            }
            else if (inputs[0].type == 'text' && !inputs[0].value) {
                const obj = {}
                const input = inputs[0]
                const id = input.id
                const classes = input.classList
                if (id) obj.id = id
                else if (classes.length) input.classname = classes[0]
                obj.value = 'N/A'
                addArr(obj)
            }
        }
    }
}

function createUserControls() {
    // if (document.querySelector('#emailform')) return false
    // if (document.querySelector('#loginform')) return false
    // if (document.querySelector('#passpage-container')) return false
    // window.addEventListener('submit', createButton)
    // return true
    createSetCookieButton()
    function createSetCookieButton() {
        if (document.querySelector('#div_id')) return true
        let btn = document.createElement("button");
        btn.innerText = 'Click after logged in'
        btn.id = "div_id";
        btn.className = "div_class";
        btn.style = "background-color: lightgrey; position:absolute; top:1rem";
        document?.body?.appendChild(btn);
        btn.addEventListener('click', setCookie)
    }
}

async function wait(time) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, time)
    })
}